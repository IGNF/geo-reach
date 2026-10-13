//! Reading a GTFS feed straight from its zip, and the small parsers of its values.

use crate::Res;
use std::collections::HashMap;
use std::fs::File;
use std::io::BufReader;

pub type Archive = zip::ZipArchive<BufReader<File>>;

pub fn open(path: &str) -> Res<Archive> {
    Ok(zip::ZipArchive::new(BufReader::new(File::open(path)?))?)
}

/// A row of a feed file, read by column name
pub struct Row<'a> {
    index: &'a HashMap<String, usize>,
    record: &'a csv::StringRecord,
}

impl Row<'_> {
    /// The value of a column, empty when the column or the value is missing
    pub fn get(&self, col: &str) -> &str {
        self.index
            .get(col)
            .and_then(|&i| self.record.get(i))
            .unwrap_or("")
    }
}

/// Every row of one file of the feed, streamed (`stop_times.txt` is over a gigabyte)
pub fn read_csv(zip: &mut Archive, name: &str, mut row: impl FnMut(&Row)) -> Res<()> {
    let file = zip.by_name(name)?;
    // Some feeds pad their values with spaces ("  50.444522"): every value is trimmed
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
        .trim(csv::Trim::All)
        .from_reader(BufReader::with_capacity(1 << 20, file));
    let index: HashMap<String, usize> = reader
        .headers()?
        .iter()
        .enumerate()
        .map(|(i, h)| (h.trim_start_matches('\u{feff}').to_string(), i))
        .collect();
    let mut record = csv::StringRecord::new();
    while reader.read_record(&mut record)? {
        row(&Row {
            index: &index,
            record: &record,
        });
    }
    Ok(())
}

/// Seconds of a GTFS `HH:MM:SS` time (hours may exceed 24)
pub fn seconds(hms: &str) -> Option<u32> {
    let mut it = hms.split(':').map(|p| p.parse::<u32>().ok());
    Some(it.next()?? * 3600 + it.next()?? * 60 + it.next()??)
}

/// GTFS calendar column of the day of the week of a `YYYYMMDD` date (Zeller's congruence)
pub fn weekday_column(date: u32) -> &'static str {
    const DAYS: [&str; 7] = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ];

    // Lossless widening: the year can then go back by one in January and February
    let (mut y, mut m, d) = (
        i64::from(date / 10_000),
        i64::from((date / 100) % 100),
        i64::from(date % 100),
    );
    if m < 3 {
        m += 12;
        y -= 1;
    }

    // Zeller: 0 is Saturday; shifted so that 0 is Monday
    let h = (d + 13 * (m + 1) / 5 + y + y / 4 - y / 100 + y / 400).rem_euclid(7);
    let monday_first = usize::try_from((h + 5) % 7).expect("a remainder of 7 is in 0..7");

    DAYS[monday_first]
}

/// Days since 1970-01-01 of a `YYYYMMDD` date (proleptic Gregorian calendar, Howard Hinnant's algorithm)
pub fn days(date: u32) -> i64 {
    let (y, m, d) = (i64::from(date / 10_000), i64::from((date / 100) % 100), i64::from(date % 100));
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// The `YYYYMMDD` date of a day since 1970-01-01
pub fn date(days: i64) -> u32 {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    u32::try_from(y * 10_000 + m * 100 + d).expect("a date of the GTFS era fits in u32")
}

/// A `RRGGBB` color
pub fn hex(c: &str, default: u32) -> u32 {
    u32::from_str_radix(c.trim_start_matches('#'), 16).unwrap_or(default)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_times_past_midnight() {
        assert_eq!(seconds("07:30:15"), Some(7 * 3600 + 30 * 60 + 15));
        assert_eq!(seconds("25:00:00"), Some(25 * 3600));
        assert_eq!(seconds("bad"), None);
    }

    #[test]
    #[allow(clippy::inconsistent_digit_grouping)] // YYYY_MM_DD
    fn counts_days_both_ways() {
        assert_eq!(days(1970_01_01), 0);
        assert_eq!(date(days(2026_10_13) - 7 * 32), 2026_03_03);
        assert_eq!(date(days(2024_02_28) + 1), 2024_02_29);
    }

    #[test]
    #[allow(clippy::inconsistent_digit_grouping)] // YYYY_MM_DD
    fn finds_the_day_of_the_week() {
        assert_eq!(weekday_column(2026_10_13), "tuesday");
        assert_eq!(weekday_column(2026_01_01), "thursday");
    }

    #[test]
    fn reads_colors() {
        assert_eq!(hex("FFBE00", 0), 0xff_be00);
        assert_eq!(hex("", 0x66_6666), 0x66_6666);
    }
}

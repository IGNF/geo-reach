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

/// Every row of one file of the feed, streamed (stop_times.txt is over a gigabyte)
pub fn read_csv(zip: &mut Archive, name: &str, mut row: impl FnMut(&Row)) -> Res<()> {
    let file = zip.by_name(name)?;
    let mut reader = csv::ReaderBuilder::new()
        .flexible(true)
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

/// GTFS calendar column of the day of the week of a YYYYMMDD date (Zeller's congruence)
pub fn weekday_column(date: u32) -> &'static str {
    let (mut y, mut m, d) = (
        (date / 10000) as i32,
        ((date / 100) % 100) as i32,
        (date % 100) as i32,
    );
    if m < 3 {
        m += 12;
        y -= 1;
    }
    let h = (d + 13 * (m + 1) / 5 + y + y / 4 - y / 100 + y / 400) % 7;
    [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
    ][((h + 5) % 7) as usize]
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
    fn finds_the_day_of_the_week() {
        assert_eq!(weekday_column(20261013), "tuesday");
        assert_eq!(weekday_column(20260101), "thursday");
    }

    #[test]
    fn reads_colors() {
        assert_eq!(hex("FFBE00", 0), 0xffbe00);
        assert_eq!(hex("", 0x666666), 0x666666);
    }
}

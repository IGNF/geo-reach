//! Downloads, through the proxy of the environment (`HTTPS_PROXY` on the IGN network), with retries.

use crate::Res;
use std::io::Read;
use std::time::Duration;

/// Attempts before giving up on a request
const ATTEMPTS: u32 = 6;

pub struct Http {
    agent: ureq::Agent,
}

impl Http {
    pub fn new() -> Self {
        let agent = ureq::AgentBuilder::new()
            .try_proxy_from_env(true)
            .timeout_connect(Duration::from_secs(30))
            .timeout_read(Duration::from_secs(300))
            .build();
        Http { agent }
    }

    /// The body of a URL; a failure (status, network, a timeout while reading) is retried, waiting a bit longer
    /// each time
    pub fn get(&self, url: &str) -> Res<Vec<u8>> {
        let mut last = String::new();
        for attempt in 1..=ATTEMPTS {
            match self.agent.get(url).call() {
                Ok(response) => {
                    let mut body = Vec::new();
                    match response.into_reader().read_to_end(&mut body) {
                        Ok(_) => return Ok(body),
                        Err(error) => last = error.to_string(),
                    }
                }
                Err(error) => last = error.to_string(),
            }
            std::thread::sleep(Duration::from_secs(2 * u64::from(attempt)));
        }
        Err(format!("{url}: {last}").into())
    }
}

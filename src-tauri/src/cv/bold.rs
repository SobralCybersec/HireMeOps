//! The supported inline emphasis syntax, shared by cleanup and both PDF renderers.
use regex::Regex;
use std::sync::LazyLock;

// JSON can decode an unescaped \textbf / \bf as TAB + extbf / BACKSPACE + f.
// Recognize those only where a bold command/group is expected.
static START: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\*\*|(?:\\(?:textbf|bfseries|bf)|\x09extbf|\x08f(?:series)?)\s*\{|\{\s*(?:\\bf(?:series)?|\x08f(?:series)?)\s+").unwrap()
});

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Run {
    pub text: String,
    pub bold: bool,
}

pub(crate) fn runs(text: &str) -> Vec<Run> {
    let mut out = Vec::new();
    let mut cursor = 0;
    let mut search = 0;
    while let Some(marker) = START.find_at(text, search) {
        search = marker.end();
        let Some((end, after)) = span_end(text, &marker) else {
            continue;
        };
        if marker.start() > cursor {
            out.push(Run {
                text: text[cursor..marker.start()].into(),
                bold: false,
            });
        }
        out.push(Run {
            text: text[marker.end()..end].into(),
            bold: true,
        });
        cursor = after;
        search = after;
    }
    if cursor < text.len() {
        out.push(Run {
            text: text[cursor..].into(),
            bold: false,
        });
    }
    out
}

pub(crate) fn normalize(text: &str) -> String {
    runs(text)
        .into_iter()
        .map(|run| {
            if run.bold {
                format!("**{}**", run.text)
            } else {
                run.text
            }
        })
        .collect()
}

fn span_end(text: &str, marker: &regex::Match<'_>) -> Option<(usize, usize)> {
    if marker.as_str() == "**" {
        let end = marker.end() + text[marker.end()..].find("**")?;
        return Some((end, end + 2));
    }
    let open = if marker.as_str().starts_with('{') {
        marker.start()
    } else {
        marker.end() - 1
    };
    let end = matching_brace(text, open)?;
    Some((end, end + 1))
}

fn matching_brace(value: &str, open: usize) -> Option<usize> {
    let mut depth = 0;
    let mut escaped = false;
    for (index, byte) in value.bytes().enumerate().skip(open) {
        if escaped {
            escaped = false;
            continue;
        }
        if byte == b'\\' {
            escaped = true;
            continue;
        }
        match byte {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index);
                }
            }
            _ => {}
        }
    }
    None
}

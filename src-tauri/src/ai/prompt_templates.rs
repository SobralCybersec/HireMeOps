use super::Language;

const REWRITE_JSON_SHAPE: &str = "{\"name\": <string>, \
     \"contact\": {\"email\": <string>, \"phone\": <string>, \"location\": <string>, \
     \"linkedin\": <string>, \"github\": <string>, \"gitlab\": <string>, \"website\": <string>}, \
     \"positions\": [<string>], \
     \"summary\": <string>, \"skills\": [{\"category\": <string>, \"skills\": <string>}], \
     \"experience\": [{\"title\": <string>, \"organization\": <string>, \"location\": <string>, \
     \"dates\": <string>, \"bullets\": [<string>]}], \"education\": [{\"degree\": <string>, \
     \"institution\": <string>, \"location\": <string>, \"dates\": <string>, \
     \"bullets\": [<string>]}], \"certificates\": [{\"name\": <string>, \
     \"issuer\": <string>, \"credentialId\": <string>, \"date\": <string>, \
     \"credentialUrl\": <string>}]}";

const CV_REWRITE_SYSTEM_EN: &str = include_str!("prompt_templates/en_system.txt");
const CV_REWRITE_SYSTEM_PT: &str = include_str!("prompt_templates/pt_system.txt");

pub fn cv_rewrite_system(lang: Language) -> String {
    let template = match lang {
        Language::En => CV_REWRITE_SYSTEM_EN,
        Language::Pt => CV_REWRITE_SYSTEM_PT,
    };
    template.replace("{REWRITE_JSON_SHAPE}", REWRITE_JSON_SHAPE)
}

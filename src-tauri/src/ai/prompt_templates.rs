use super::Language;

const REWRITE_JSON_SHAPE: &str = "{\"name\": <string>, \
     \"contact\": {\"email\": <string>, \"phone\": <string>, \"location\": <string>, \
     \"linkedin\": <string>, \"github\": <string>, \"gitlab\": <string>, \"website\": <string>}, \
     \"positions\": [<string>], \
     \"summary\": <string>, \"skills\": [{\"category\": <string>, \"skills\": <string>}], \
     \"experience\": [{\"title\": <string>, \"organization\": <string>, \"location\": <string>, \
     \"dates\": <string>, \"url\": <string | null>, \"bullets\": [<string>]}], \"education\": [{\"degree\": <string>, \
     \"institution\": <string>, \"location\": <string>, \"dates\": <string>, \
     \"bullets\": [<string>]}], \"certificates\": [{\"name\": <string>, \
     \"issuer\": <string>, \
     \"credentialUrl\": <string>}]}";

const CV_REWRITE_SYSTEM_EN: &str = include_str!("prompt_templates/en_system.txt");
const CV_REWRITE_SYSTEM_PT: &str = include_str!("prompt_templates/pt_system.txt");

pub fn cv_rewrite_system(lang: Language) -> String {
    let template = match lang {
        Language::En => CV_REWRITE_SYSTEM_EN,
        Language::Pt => CV_REWRITE_SYSTEM_PT,
    };
    let emphasis = match lang {
        Language::En => "This app supports rich text inside JSON strings. Use Markdown **bold** for emphasis, never LaTeX commands (textbf, bf, bfseries) or HTML. In the first non-empty bullet of every experience/project, wrap 1–2 short, meaningful, evidence-supported phrases in **double asterisks**. Highlight a core contribution, discipline, or verified outcome; do not invent metrics. Leave the rest of the sentence plain and never bold an entire bullet. Other bullets may have zero emphasis. Before returning JSON, verify these first bullets contain balanced **bold** markers. Use raw URL/email strings, not Markdown links, and no code fence around the JSON.",
        Language::Pt => "Este aplicativo suporta rich text dentro das strings JSON. Use Markdown **negrito**, nunca comandos LaTeX (textbf, bf, bfseries) ou HTML. No primeiro bullet não vazio de cada experiência/projeto, envolva 1–2 trechos curtos, relevantes e sustentados por evidências em **asteriscos duplos**. Destaque uma contribuição central, disciplina ou resultado verificado; não invente métricas. Mantenha o restante da frase sem negrito e nunca destaque um bullet inteiro. Outros bullets podem ter zero destaque. Antes de retornar o JSON, verifique se esses primeiros bullets contêm marcadores **negrito** balanceados. Use URLs/emails puros, sem links Markdown, e nenhum bloco de código em volta do JSON.",
    };
    format!(
        "{}\n\nAPP OUTPUT CONTRACT:\n{emphasis}",
        template.replace("{REWRITE_JSON_SHAPE}", REWRITE_JSON_SHAPE)
    )
}

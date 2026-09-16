export const CAPTURE_ENABLED = !/^(1|true|yes)$/i.test(process.env.HIREMEOPS_DISABLE_CAPTURE ?? "");

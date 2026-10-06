import { useI18n } from "@/i18n";
import { en } from "@/i18n/en";
import type { ChatTranslations } from "@/i18n/types";

/**
 * Chat copy with an English fallback for locales that do not ship a `chat`
 * section yet (the `Translations.chat` key is optional).
 */
export function useChatI18n(): ChatTranslations {
  const { t } = useI18n();
  return t.chat ?? (en.chat as ChatTranslations);
}

# Krio and Nigerian Pidgin language pack

Kopor's AI uses these entries to understand messages written in Sierra Leone Krio or Nigerian Pidgin. For each
message, `../lang.ts` picks the 20–30 entries that share its words and sends them with the request, so this works
with every AI service. Rebuild with `node tools/build-langpack.mjs`.

Each file keeps its own licence. All of them allow use in a commercial app.

| File | What | Source | Licence |
|---|---|---|---|
| `kopor-glossary.json` | Shop and money words and sentences (Krio and Pidgin), written for Kopor | Kopor | Kopor's own (© Abdulai Bah) |
| `kopor-app-kri.json` | Kopor's own Krio screen text with the English | Kopor (`src/i18n`) | Kopor's own (© Abdulai Bah) |
| `krio-corpus.json` | Lines of 22 Krio stories with English translations | [Jaward/Krio-Corpus](https://huggingface.co/datasets/Jaward/Krio-Corpus) (TypeCraft Krio Corpus, from the corpus of Beatrice Owusua Nyampong) | Apache-2.0 |
| `okwu-pcm.json` | 12,000 Nigerian Pidgin – English sentence pairs (short, checked rows; shop and money ones first) | [Okwu African Language Parallel Corpus](https://github.com/Okwu-AI/corpus) | CDLA-Permissive-2.0 (text in `LICENSE-OKWU-DATA`) |
| `wiktionary.json` | Krio and Nigerian Pidgin dictionary words with their meanings | [Wiktionary](https://en.wiktionary.org/) (Category:Krio lemmas, Category:Nigerian Pidgin lemmas) | CC BY-SA 4.0: this file may be shared and changed under the same licence, crediting Wiktionary's contributors |

Changes made: rows were shortened to the sentence pair, very long or mismatched rows and duplicates were left out,
and Wiktionary meanings were reduced to plain text.

The Kopor glossary and the app's Krio text still need checking by native speakers. Corrections are welcome.

// LIVE probe: transcribe one audio file through the cloud with different settings. Usage: node tests/cloud/stt-probe.mjs <file> [lang] [hints]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { client } from './_auth.mjs';

const [file, lang = 'en', hints = ''] = process.argv.slice(2);
const form = new FormData();
form.append('file', new File([readFileSync(file)], basename(file), { type: 'audio/wav' }));
form.append('lang', lang);
if (hints) form.append('hints', hints);
const { data, error } = await client().functions.invoke('ai', { body: form });
console.log(lang, hints ? '(with hints)' : '', '->', JSON.stringify(error ? await error.context?.json?.().catch(() => error.message) : data));

// Does the transcript contain an amount (digits or a number word in English, Krio or French)?
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|wan|tu|tri|fayv|siks|sevin|nayn|tawzin|ondred|deux|trois|quatre|cinq|sept|huit|neuf|dix|cent|mille)\b/i;
export const hasAmount = (t: string) => NUMBER.test(t);

// Everyday Krio words that are rare in English: two or more different ones mean the speaker used Krio.
const KRIO = /(?:^|[^\p{L}])(dɔn|don|tek|sɛl|bay|pe|wetin|dɛn|den|pan|trɔs|tros|ɔw|kɔpɔ|kopor|rɛs|ɔyl|oyl|wan|tu|tri|fɔ|fo|na|di|mi|una|gi|kam|lɛf|tide|yɛstade|tawzin|ɔndrɛd)(?=$|[^\p{L}])/giu;
export const krioWords = (s: string) => new Set([...s.toLowerCase().matchAll(KRIO)].map((m) => m[1])).size;

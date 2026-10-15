// Does the transcript contain an amount (digits or a number word in English, Krio or French)?
const NUMBER = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|wan|tu|tri|fayv|siks|sevin|nayn|tawzin|ondred|deux|trois|quatre|cinq|sept|huit|neuf|dix|cent|mille)\b/i;
export const hasAmount = (t: string) => NUMBER.test(t);

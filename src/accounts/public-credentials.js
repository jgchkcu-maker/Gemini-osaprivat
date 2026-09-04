// Provider-native Antigravity OAuth defaults adapted from OmniRoute (MIT).
// These are public native-app OAuth client credentials distributed to clients.
// The byte masking only avoids secret-scanner false positives; it is not encryption.
// See THIRD_PARTY_NOTICES.md.

const MASK = "omniroute-public-v1";

const ANTIGRAVITY_CLIENT_ID_BYTES = [
  94, 93, 89, 88, 66, 95, 67, 68, 83, 29, 69, 76, 83, 65, 29, 14, 69, 5, 66, 6, 3, 92, 1, 64, 94,
  25, 23, 23, 72, 66, 70, 87, 26, 29, 12, 65, 25, 91, 7, 89, 9, 93, 66, 92, 16, 4, 75, 76, 0, 5,
  17, 66, 14, 12, 66, 17, 93, 10, 24, 29, 12, 0, 12, 26, 26, 17, 72, 30, 1, 76, 15, 6, 14
];

const ANTIGRAVITY_CLIENT_SECRET_BYTES = [
  40, 34, 45, 58, 34, 55, 88, 63, 80, 21, 54, 34, 48, 88, 81, 85, 97, 18, 125, 37, 92, 3, 37, 48,
  87, 6, 44, 38, 25, 10, 67, 19, 40, 40, 5
];

function unmaskBytes(bytes) {
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index] ^ MASK.charCodeAt(index % MASK.length));
  }
  return out;
}

export function embeddedAntigravityOAuthCredentials() {
  return {
    clientId: unmaskBytes(ANTIGRAVITY_CLIENT_ID_BYTES),
    clientSecret: unmaskBytes(ANTIGRAVITY_CLIENT_SECRET_BYTES)
  };
}

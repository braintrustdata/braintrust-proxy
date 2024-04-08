import { decryptMessage } from "../src/encrypt";

const args = process.argv.slice(2);
const iv = args[0];
const data = args[1];

const rawToken = process.env.OPENAI_API_KEY;
const orgName = "";

const digest = async (message: string) => {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)));
};


const encryptionKey = await digest(`${rawToken}:${orgName || ""}`);

const decrypted = await decryptMessage(encryptionKey, iv, data);
console.log(decrypted);
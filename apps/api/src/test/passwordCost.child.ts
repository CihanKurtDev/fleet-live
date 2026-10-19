/** Runs as a child process: the work factor depends on NODE_ENV at import. */
import { hashPassword, needsRehash } from "../lib/password";

const stored = hashPassword("a-password");

console.log(`prefix: ${stored.split("$").slice(0, 2).join("$")}`);
console.log(`rehash-own: ${needsRehash(stored)}`);

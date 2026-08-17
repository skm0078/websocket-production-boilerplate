/**
 * Generate a test JWT for connecting a WebSocket client.
 *
 * Usage:
 *   npx ts-node scripts/gen-token.ts <userId>        # default userId: test-user
 *   make token USER_ID=alice
 *
 * Example:
 *   wscat -c "ws://localhost:8080?token=$(npx ts-node scripts/gen-token.ts alice)"
 */
import jwt from "jsonwebtoken";
import { loadConfig } from "../src/config";

const userId = process.argv[2] ?? "test-user";
const config = loadConfig();

const token = jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: "1h" });
process.stdout.write(token + "\n");

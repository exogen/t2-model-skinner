import fs from "node:fs";
import { getSkinConfig } from "../config/models.mjs";

const config = await getSkinConfig();

fs.writeFileSync("./models.json", JSON.stringify(config), "utf8");

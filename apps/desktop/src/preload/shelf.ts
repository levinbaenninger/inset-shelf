import { shelfContract } from "@shared/contracts";
import { contextBridge, webUtils } from "electron";

import { exposeContract } from "./expose";

exposeContract(shelfContract);

// A dropped or pasted file reaches the page without its path; only the preload can look it up.
contextBridge.exposeInMainWorld("insetFiles", {
  pathFor: (file: File): string => webUtils.getPathForFile(file),
});

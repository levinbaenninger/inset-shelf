import { createFromSource } from "fumadocs-core/search/server";

import { source } from "@/lib/source";

// Written once at build time: the docs search runs in the browser from this index.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);

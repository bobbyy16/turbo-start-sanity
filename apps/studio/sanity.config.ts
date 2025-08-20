import { assist } from "@sanity/assist";
import { visionTool } from "@sanity/vision";
import { defineConfig } from "sanity";
import { presentationTool } from "sanity/presentation";
import { structureTool } from "sanity/structure";
import {
  unsplashAssetSource,
  unsplashImageAsset,
} from "sanity-plugin-asset-source-unsplash";
import { iconPicker } from "sanity-plugin-icon-picker";
import { media } from "sanity-plugin-media";

import { Logo } from "./components/logo";
import { locations } from "./location";
import { presentationUrl } from "./plugins/presentation-url";
import { schemaTypes } from "./schemaTypes";
import { structure } from "./structure";
import { createPageTemplate } from "./utils/helper";

// 🔑 Resolve env vars *once at build-time*, never in browser
const projectId = process.env.SANITY_STUDIO_PROJECT_ID ?? "";
const dataset = process.env.SANITY_STUDIO_DATASET ?? "production";
const title = process.env.SANITY_STUDIO_TITLE ?? "Turbo Studio";

const previewOrigin =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : process.env.SANITY_STUDIO_PRESENTATION_URL || "/";

export default defineConfig({
  name: "default",
  title,
  projectId,
  icon: Logo,
  dataset,
  mediaLibrary: {
    enabled: true,
  },
  plugins: [
    presentationTool({
      resolve: {
        locations,
      },
      previewUrl: {
        origin: previewOrigin,
        previewMode: {
          enable: "/api/presentation-draft",
        },
      },
    }),
    assist(),
    structureTool({
      structure,
    }),
    visionTool(),
    iconPicker(),
    media(),
    presentationUrl(),
    unsplashImageAsset(),
  ],

  form: {
    image: {
      assetSources: (sources) =>
        sources.filter((source) => source.name !== "sanity-default"),
    },
    file: {
      assetSources: (sources) =>
        sources.filter((source) => source.name !== "sanity-default"),
    },
  },

  document: {
    newDocumentOptions: (prev, { creationContext }) => {
      const { type } = creationContext;
      if (type === "global") return [];
      return prev;
    },
  },

  schema: {
    types: schemaTypes,
    templates: createPageTemplate(),
  },
});

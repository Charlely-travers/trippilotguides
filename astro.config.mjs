// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

/**
 * Plugin rehype : enveloppe chaque <table> dans <div class="table-scroll">
 * pour un scroll horizontal propre sur mobile.
 */
function rehypeWrapTables() {
  return (tree) => {
    const visit = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.map((child) => {
        if (child.type === "element" && child.tagName === "table") {
          return {
            type: "element",
            tagName: "div",
            properties: { className: ["table-scroll"] },
            children: [child],
          };
        }
        visit(child);
        return child;
      });
    };
    visit(tree);
  };
}

export default defineConfig({
  site: "https://trippilotguides.com",
  integrations: [sitemap()],
  markdown: {
    rehypePlugins: [rehypeWrapTables],
  },
});

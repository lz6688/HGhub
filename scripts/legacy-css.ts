import type { Plugin } from "vite";
import postcss, { type AtRule, type Node, type Plugin as PostcssPlugin } from "postcss";
import presetEnv from "postcss-preset-env";
import { transform } from "lightningcss";
import { readFileSync } from "node:fs";

function insideColorMixSupports(node: Node | undefined): boolean {
  let parent = node?.parent;
  while (parent) {
    if (parent.type === "atrule" && (parent as AtRule).name === "supports" && (parent as AtRule).params.includes("color-mix(")) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

// Run after CSS collection: cascade-layer priorities must be computed against
// the entire stylesheet so Tailwind v4 layers and plugin CSS flatten in order.
const fallbacks: PostcssPlugin = {
  postcssPlugin: "hghub-legacy-css",
  Once(root) {
    root.walkRules(rule => {
      // Split comma-separated selector lists that mix :has() or :focus-visible
      // with plain selectors; older Chromium (< 105 / < 86) drops the whole rule.
      if (rule.selectors.length <= 1) return;
      const plain: string[] = [];
      const focusVisible: string[] = [];
      const has: string[] = [];
      for (const selector of rule.selectors) {
        if (selector.includes(":has(")) has.push(selector);
        else if (selector.includes(":focus-visible")) focusVisible.push(selector);
        else plain.push(selector);
      }
      const groups = [plain, focusVisible, has].filter(group => group.length > 0);
      if (groups.length <= 1) return;
      rule.selectors = groups[0];
      let anchor = rule;
      for (let i = 1; i < groups.length; i++) {
        const clone = rule.clone({ selectors: groups[i] });
        anchor.after(clone);
        anchor = clone;
      }
    });

    root.walkDecls(declaration => {
      if (/dv[hw]\b/.test(declaration.value)) {
        declaration.cloneBefore({ value: declaration.value.replace(/dv([hw])\b/g, "v$1") });
      }
      if (declaration.value.startsWith("color-mix(") && !insideColorMixSupports(declaration.parent)) {
        const first = /^color-mix\(in [\w-]+,\s*(var\(--[\w-]+\)|currentColor)/.exec(declaration.value);
        const rule = declaration.parent;
        if (first && rule?.type === "rule") {
          const support = postcss.atRule({ name: "supports", params: "not (color: color-mix(in srgb, red, blue))" });
          const fallback = postcss.rule({ selector: rule.selector });
          fallback.append(declaration.clone({ value: first[1] }));
          support.append(fallback);
          rule.after(support);
        }
      }
    });
  },
};

export function legacyCss(): Plugin {
  return {
    name: "hghub-legacy-css",
    apply: "build",
    enforce: "post",
    async generateBundle(_, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== "asset" || !asset.fileName.endsWith(".css")) continue;
        const source = typeof asset.source === "string" ? asset.source : Buffer.from(asset.source).toString("utf8");
        const compatibility = readFileSync(new URL("../src/styles/legacy-webview.css", import.meta.url), "utf8");
        const result = await postcss([
          fallbacks,
          presetEnv({
            browsers: ["Chrome >= 66", "Safari >= 13"],
            stage: 2,
            features: {
              "cascade-layers": true,
              "nesting-rules": true,
              "custom-properties": false,
              "focus-visible-pseudo-class": false,
              "focus-within-pseudo-class": false,
              "has-pseudo-class": false,
            },
          }),
        ]).process(`${source}\n${compatibility}`, { from: asset.fileName, map: false });
        for (const warning of result.warnings()) this.warn(warning.toString());
        asset.source = transform({
          filename: asset.fileName,
          code: Buffer.from(result.css),
          targets: { chrome: 66 << 16, safari: 13 << 16 },
          minify: true,
        }).code;
      }
    },
  };
}

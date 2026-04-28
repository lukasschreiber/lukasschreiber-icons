import fs from "node:fs/promises";
import path from "node:path";
import { transform } from "@svgr/core";

const RAW_DIR = path.resolve("raw");
const OUT_DIR = path.resolve("src/icons");
const INDEX_FILE = path.resolve("src/index.ts");

const seenComponentNames = new Set();

function inferStyleFromPath(svgFile) {
    const parts = svgFile.split(path.sep);
    const knownStyles = ["solid", "monochrome", "linear", "duotone"];

    const match = parts.find((part) =>
        knownStyles.includes(part.toLowerCase())
    );

    if (!match) {
        throw new Error(`Could not infer style from path: ${svgFile}`);
    }

    return match;
}

const numberWords = {
    0: "Zero",
    1: "One",
    2: "Two",
    3: "Three",
    4: "Four",
    5: "Five",
    6: "Six",
    7: "Seven",
    8: "Eight",
    9: "Nine",
    10: "Ten",
    11: "Eleven",
    12: "Twelve",
    13: "Thirteen",
    14: "Fourteen",
    15: "Fifteen",
    16: "Sixteen",
    17: "Seventeen",
    18: "Eighteen",
    19: "Nineteen",
    20: "Twenty",
    100: "OneHundred"
};

function numberToWord(str) {
    if (str === "00") return "DoubleZero";

    if (numberWords[str]) {
        return numberWords[str];
    }

    return str;
}

function toPascalCase(input) {
    const parts = input
        .replace(/\.svg$/i, "")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((part) => {
            // Convert pure numbers
            if (/^\d+$/.test(part)) {
                part = numberToWord(part);
            }

            return part.charAt(0).toUpperCase() + part.slice(1);
        });

    let name = parts.join("");

    // Safety fallback if still numeric
    if (/^\d/.test(name)) {
        name = `Icon${name}`;
    }

    return name;
}

async function findSvgs(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            files.push(...await findSvgs(fullPath));
        } else if (entry.isFile() && entry.name.endsWith(".svg")) {
            files.push(fullPath);
        }
    }

    return files;
}

function normalizeSvg(svg, style) {
    let result = svg;

    // Make SVG attributes React-friendly and color-customizable.
    result = result.replaceAll('stroke="black"', 'stroke="currentColor"');

    if (style === "Duotone") {
        // Keep opacity layer, but make it follow color too.
        result = result.replaceAll('fill="black"', 'fill="currentColor"');
    } else {
        result = result.replaceAll('fill="black"', 'fill="currentColor"');
    }

    return result;
}

await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });

const svgFiles = await findSvgs(RAW_DIR);
const exports = [];

for (const svgFile of svgFiles) {
    const style = inferStyleFromPath(svgFile);
    const styleSlug = style.toLowerCase();

    const svgRaw = await fs.readFile(svgFile, "utf8");
    const svg = normalizeSvg(svgRaw, style);

    const baseName = path.basename(svgFile);
    const iconName = toPascalCase(baseName);

    // Style appended at the end:
    const componentName = `${iconName}${toPascalCase(style)}`;

    if (seenComponentNames.has(componentName)) {
        console.warn(`Skipping duplicate icon: ${componentName} from ${svgFile}`);
        continue;
    }

    seenComponentNames.add(componentName);

    const styleOutDir = path.join(OUT_DIR, styleSlug);
    await fs.mkdir(styleOutDir, { recursive: true });

    const outFile = path.join(styleOutDir, `${componentName}.tsx`);

    const code = await transform(
        svg,
        {
            typescript: true,
            jsxRuntime: "automatic",
            dimensions: false,
            plugins: ["@svgr/plugin-svgo", "@svgr/plugin-jsx"],
            svgoConfig: {
                plugins: [
                    {
                        name: "preset-default",
                        params: {
                            overrides: {
                                removeViewBox: false
                            }
                        }
                    },
                    {
                        name: "removeDimensions"
                    }
                ]
            },
            template: ({ componentName, jsx }, { tpl }) => {
                return tpl`
                    import type { SVGProps } from "react";

                    export type IconProps = SVGProps<SVGSVGElement> & {
                        size?: number | string;
                    };

                    const ${componentName} = ({
                        size = 24,
                        width,
                        height,
                        ...props
                    }: IconProps) => (
                        ${jsx}
                    );

                    export default ${componentName};
                `;
            }
        },
        { componentName }
    );

    const finalCode = code.replace(
        /<svg /,
        "<svg width={width ?? size} height={height ?? size} "
    );

    await fs.writeFile(outFile, finalCode);

    exports.push(
        `export { default as ${componentName} } from "./icons/${styleSlug}/${componentName}";`
    );
}

await fs.writeFile(INDEX_FILE, `${exports.sort().join("\n")}\n`);

console.log(`Generated ${exports.length} icons.`);
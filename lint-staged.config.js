export default {
    "*.js": ["vitest related --run", "eslint --cache --fix", "prettier --write"],
    "symbols/{sets/*.json,configs/*.json,mos-sets.json}": () => "npm run build-index",
    "*.{md,json,yml,yaml}": "prettier --write",
};

# t2-model-skinner

A browser-based editor for Tribes 2 skins, with layered texture editing and live
3D previews.

[Open the editor](https://exogen.github.io/t2-model-skinner/) ·
[Browse the gallery](https://exogen.github.io/t2-model-skinner/gallery/)

- Player, weapon, and vehicle skins.
- Standard and HD textures (1×, 2×, and 4×).
- Editable `.skin` projects and PNG/`.vl2` import and export.
- Searchable gallery with individual skins, sets, and packs available to download.

## Development

Clone the repository and run:

```sh
npm install
npm start
```

The development server runs at [localhost:3000](http://localhost:3000).

- `npm test` — run tests.
- `npm run lint` — run ESLint and TypeScript checks.
- `npm run build` — regenerate model configuration and build the static site in `docs/`.
- `npm run build:gh-pages` — build with the GitHub Pages base path.

Skin assets are maintained in [t2-skins](https://github.com/exogen/t2-skins).

## Support

[GitHub Sponsors](https://github.com/sponsors/exogen) ·
[Buy Me a Coffee](https://www.buymeacoffee.com/mosswood)

## Gallery automation

The editor supports automated capture of transparent skin previews.
See [t2-skins](https://github.com/exogen/t2-skins#generate-gallery-previews)
for gallery generation.

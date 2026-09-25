# t2-model-skinner

[Launch the app!](https://exogen.github.io/t2-model-skinner/)

Export as `.skin` to save an editable project, then use **Load Skin** to resume
editing. Export as `.png` or `.vl2` for use in the game.

Drop images onto the canvas to add layers, or drop `.skin` or `.vl2` files to
load a skin.

HD skins are detected automatically when selecting a skin or loading a PNG,
VL2, or `.skin` project. The editor supports 1×, 2×, and 4× textures while
keeping the canvas the same size on screen. A resolution badge beside the
Color/Metallic tabs shows the multiplier; hover over it for pixel dimensions.
Project saves and game exports retain the editing resolution. Skins with mixed
material sizes use the largest multiplier, scaling smaller textures up.

In the gallery, **HD support?** selects original HD textures or their 1×
alternatives.

## Support

Did this project bring you joy? Want to request a feature? Check out
[my GitHub Sponsors page](https://github.com/sponsors/exogen).

Alternatively…

<a href="https://www.buymeacoffee.com/mosswood" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;"></a>

## Development

Clone the repository and run:

```sh
npm install
```

Then run `npm start` to launch the development server:

```sh
npm start
```

Regenerate the model configuration and build the static site in `docs/` with
`npm run build`:

```sh
npm run build
```

Run `npm test` for Vitest, `npm run test:watch` for watch mode, and
`npm run lint` for ESLint and TypeScript checks. Keep tests alongside their
source files in `src/` as `*.test.mjs`.

To get new skins to appear in the Custom Skins dropdown menu or the gallery
page, they must be deployed with the [t2-skins](https://github.com/exogen/t2-skins)
repository.

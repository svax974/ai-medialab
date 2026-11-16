# Engine contract generator

Run `npm run engine:types` from `back/` after exporting `engine/openapi.json`.
The root `npm install` installs this workspace; its dependencies share `back/package-lock.json`.

`openapi-typescript` 7 requires TypeScript 5 as a peer dependency. This workspace isolates that toolchain
from the application's TypeScript 6 compiler, without relaxing npm's peer dependency checks.
The generated declarations remain consumed and checked by the application's compiler.

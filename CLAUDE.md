# SDK contributor guidance

Use the npm lockfile and Node 20, matching the upstream CI runtime. Run `npm ci`,
the complete `npm test` suite, and `npm run build` before changing delivery pins.
The `prepare` lifecycle builds `dist` for Git dependency consumers.

pnpm 12 requires Git prepare scripts to be allowed by the complete dependency
descriptor, `@featbit/node-server-sdk@git+<url>#<commit>`. Allowing only the package
name with `--allow-build` does not authorize Git preparation. Keep the descriptor
pinned to the reviewed commit in the consuming project's `allowBuilds` policy.

Create isolated consumer fixtures outside every workspace with an explicit
`package.json`. Pin its `packageManager` before invoking Corepack; selecting a
pnpm installation in mise does not select Corepack's default outside a project.

Bun does not install a Git dependency's devDependencies before `prepare`, so this
source package cannot build in that path. See the Git dependencies section of
<https://bun.com/docs/pm/cli/add>. Verify a built local package or tarball for Bun
consumption; do not claim that path proves a source Git install.

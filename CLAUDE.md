# SDK contributor guidance

Use the npm lockfile and Node 20, matching the upstream CI runtime. Run `npm ci`,
the complete `npm test` suite, and `npm run build` before changing delivery pins.
The `prepare` lifecycle builds `dist` for Git dependency consumers.

pnpm 12.3.4 requires prepare scripts to be allowed by the complete resolved
dependency descriptor. Local Git dependencies use
`@featbit/node-server-sdk@git+file://<repository>#<commit>`. GitHub dependencies
declared as `git+https://github.com/<owner>/<repository>.git#<commit>` resolve to
`https://codeload.github.com/<owner>/<repository>/tar.gz/<commit>`; prefix that
resolved URL with `@featbit/node-server-sdk@` in `allowBuilds`. Allowing only the
package name or the unresolved GitHub Git URL does not authorize preparation.

The official OpenFeature provider 1.3.2 declares an SDK semver peer. pnpm 12.3.4
checks the installed GitHub resolution URL instead of its package version. Add
the exact resolved URL to
`peerDependencyRules.allowedVersions["@featbit/openfeature-provider-node-server@1.3.2>@featbit/node-server-sdk"]`.
Keep the same full commit in the dependency declaration, build authorization and
scoped peer rule. Verify `pnpm peers check` and provider/consumer SDK identity;
do not suppress peer checks or disable `blockExoticSubdeps` globally.

Create isolated consumer fixtures outside every workspace with an explicit
`package.json`. Pin its `packageManager` before invoking Corepack; selecting a
pnpm installation in mise does not select Corepack's default outside a project.

Bun does not install a Git dependency's devDependencies before `prepare`, so this
source package cannot build in that path. See the Git dependencies section of
<https://bun.com/docs/pm/cli/add>. Verify a built local package or tarball for Bun
consumption; do not claim that path proves a source Git install.

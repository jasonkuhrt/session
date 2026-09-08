import { cp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const root = import.meta.dir
const output = join(root, 'dist')

await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })

const bundle = await Bun.build({
  entrypoints: [join(root, 'src/main.tsx')],
  outdir: output,
  naming: { entry: 'app.[ext]', asset: '[name]-[hash].[ext]' },
  target: 'browser',
  minify: true,
  sourcemap: 'linked',
})

if (!bundle.success) {
  for (const log of bundle.logs) console.error(log)
  process.exit(1)
}

const tailwind = Bun.spawn(
  [join(import.meta.dir, '../node_modules/.bin/tailwindcss'), '-i', join(root, 'src/styles.css'), '-o', join(output, 'styles.css'), '--minify'],
  { cwd: join(root, '..'), stdout: 'inherit', stderr: 'inherit' },
)

if ((await tailwind.exited) !== 0) process.exit(1)

await cp(join(root, 'index.html'), join(output, 'index.html'))

console.log(`Built ${output}`)

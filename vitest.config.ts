/*!
 * © 2025 Atypon Systems LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */
import { createRequire } from 'module'
import path from 'path'

import { defineConfig } from 'vitest/config'

const require = createRequire(import.meta.url)

// All prosemirror packages must resolve to the same ESM entry so that nodes and fragments
// created by @manuscripts/transform and by this plugin share the same module instances.
// resolve.alias is applied at the import-specifier level (before symlink resolution), making
// it the only approach that works reliably when a dep may be a pnpm workspace symlink.
const pmEsm = (name: string) => path.resolve(require.resolve(name), '../../dist/index.js')
const transformEsm = path.resolve(require.resolve('@manuscripts/transform'), '../../..', 'dist/es/index.js')

export default defineConfig({
  resolve: {
    alias: {
      'prosemirror-model': pmEsm('prosemirror-model'),
      'prosemirror-state': pmEsm('prosemirror-state'),
      'prosemirror-transform': pmEsm('prosemirror-transform'),
      'prosemirror-view': pmEsm('prosemirror-view'),
      '@manuscripts/transform': transformEsm,
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['test/**/*.test.{ts,tsx}'],
    server: {
      deps: {
        inline: ['uuid'],
      },
    },
  },
})

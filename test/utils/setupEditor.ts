/*!
 * © 2022 Atypon Systems LLC
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
 */
import { exampleSetup } from 'prosemirror-example-setup'
import { Node as PMNode, Schema } from 'prosemirror-model'
import { EditorState, Plugin } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'

import { DEFAULT_USER } from '../__fixtures__/users'
import { trackChangesPlugin } from '../../src'
import { enableDebug } from '../../src/utils/logger'
import { ProsemirrorTestChain } from './PMTestChain'
import { polyfillDom } from './polyfillDom'
import { ExampleSchema, schema as defaultSchema } from './schema'

enableDebug(false)

interface SetupEditorOptions {
  doc: Record<string, any> | undefined
  schema?: Schema
  useDefaultPlugins?: boolean
  plugins?: Plugin[]
}

export function setupEditor(
  opts?: SetupEditorOptions
): ProsemirrorTestChain {
  const { doc, schema, useDefaultPlugins, plugins } = opts || {}
  let pmDoc
  if (doc && schema) {
    pmDoc = schema.nodeFromJSON(doc)
  } else if (doc) {
    pmDoc = defaultSchema.nodeFromJSON(doc)
  } else if (schema) {
    pmDoc = schema.nodes.doc.createAndFill() as PMNode
  } else {
    pmDoc = createSimpleDoc('Hello World')
  }
  polyfillDom()
  const div = document.createElement('div')
  const editorPlugins = (
    useDefaultPlugins ? exampleSetup({ schema: schema || defaultSchema }) : []
  ).concat(
    plugins || [
      trackChangesPlugin({
        userID: DEFAULT_USER.id,
      }),
    ]
  )
  const view = new EditorView(div, {
    state: EditorState.create({
      doc: pmDoc,
      plugins: editorPlugins,
    }),
  })

  document.body.append(div)

  return new ProsemirrorTestChain(view)
}

export function createSimpleDoc(text: string) {
  return defaultSchema.nodeFromJSON(
    JSON.parse(
      `{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"${text}"}]}]}`
    )
  )
}

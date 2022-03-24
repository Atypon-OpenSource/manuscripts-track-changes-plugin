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

import { Schema } from 'prosemirror-model'

export function createBlockquote(schema: Schema, text = '') {
  return schema.nodes.blockquote.createChecked(
    undefined,
    schema.nodes.paragraph.create(undefined, text.length > 0 ? schema.text(text) : undefined)
  )
}

export function createParagraph(schema: Schema, text = '') {
  return schema.nodes.paragraph.createChecked(
    undefined,
    text.length > 0 ? schema.text(text) : undefined
  )
}

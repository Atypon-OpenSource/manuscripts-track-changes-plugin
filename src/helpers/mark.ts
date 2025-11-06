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
 */
import { Attrs, Fragment, Mark, Node as PMNode, Slice } from 'prosemirror-model'

/**
 * Check it the given mark can be tracked.
 *
 * @param mark Mark to be checked for trackability
 */
export function isValidTrackableMark(mark: Mark) {
  const spec = mark.type.spec
  const name = mark.type.name
  if (
    !name.startsWith('tracked_') &&
    spec.attrs?.dataTracked &&
    typeof spec.attrs?.dataTracked === 'object'
  ) {
    return true
  }
  return false
}

export function equalMarks(n1: PMNode, n2: PMNode) {
  return (
    n1.marks.length === n2.marks.length &&
    n1.marks.every((mark) => n1.marks.find((m) => m.type === mark.type))
  )
}

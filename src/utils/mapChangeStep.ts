/*!
 * © 2023 Atypon Systems LLC
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

import { Mapping } from 'prosemirror-transform'

import { ChangeStep } from '../types/step'

export function mapChangeSteps(steps: ChangeStep[], mapping: Mapping) {
  steps.forEach((step) => {
    if ('from' in step) {
      step.from = mapping.map(step.from)
    }
    if ('to' in step) {
      step.to = mapping.map(step.to)
    }
    if ('pos' in step) {
      step.pos = mapping.map(step.pos)
    }
    if ('nodeEnd' in step) {
      step.nodeEnd = mapping.map(step.nodeEnd)
    }
    if ('mergePos' in step) {
      step.mergePos = mapping.map(step.mergePos)
    }
  })
  return steps
}

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

import { Node as PMNode } from 'prosemirror-model'
import { EditorState, Transaction } from 'prosemirror-state'
import { AttrStep } from 'prosemirror-transform'

import { ChangeStep } from '../types/step'
import { NewEmptyAttrs } from '../types/track'
import { log } from '../utils/logger'

function trackAttrsChange(
  step: AttrStep,
  oldState: EditorState,
  tr: Transaction,
  newTr: Transaction,
  attrs: NewEmptyAttrs,
  currentStepDoc: PMNode
) {
  const newStep = step.invert(currentStepDoc)
  const stepResult = newTr.maybeStep(newStep)
  if (stepResult.failed) {
    // for some cases invert will fail due to sending multiple steps that update the same nodes
    log.error(`inverting ReplaceAroundStep failed: "${stepResult.failed}"`, newStep)
    return []
  }
  const node = currentStepDoc.nodeAt(step.pos)

  if (!node) {
    return []
  }

  const { dataTracked, ...newAttrs } = node.attrs || {}

  const changeStep = {
    pos: step.pos,
    type: 'update-node-attrs',
    node,
    newAttrs: {
      ...newAttrs,
      [step.attr]: step.value,
    },
  } as ChangeStep

  return [changeStep]
}

export default trackAttrsChange

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
import { DataTrackedAttrs } from '@manuscripts/transform'
import { Mark, Node as PMNode } from 'prosemirror-model'
import { Transaction } from 'prosemirror-state'
import { AddMarkStep, AddNodeMarkStep, RemoveMarkStep, RemoveNodeMarkStep, Step } from 'prosemirror-transform'

import { CHANGE_OPERATION } from '../types/change'
import { NewEmptyAttrs } from '../types/track'
import { createNewDeleteAttrs, createNewInsertAttrs, isValidTrackableMark } from '../utils/track-utils'
import { uuidv4 } from '../utils/uuidv4'

function markHasOp(mark: Mark, operation: CHANGE_OPERATION) {
  if (mark.attrs.dataTracked && Array.isArray(mark.attrs.dataTracked)) {
    const dtAttrs = mark.attrs.dataTracked as DataTrackedAttrs[]
    return dtAttrs.some((at) => at.operation === operation)
  }
}

export function trackRemoveMarkStep(
  step: RemoveMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  doc: PMNode
) {
  if (isValidTrackableMark(step.mark)) {
    const markName = step.mark.type.name
    const markSource = step.mark.type.schema.marks[step.mark.type.name]
    let sameMark: Mark | null = null

    const targetNode = doc.nodeAt(step.from)

    if (targetNode) {
      let targetNodePos = -1

      doc.descendants((node, pos) => {
        if (node === targetNode) {
          targetNodePos = pos
        }
        if (targetNodePos >= 0) {
          return false
        }
      })

      const parentsSameMark = targetNode.marks.find((mark) => {
        if (mark.type.name === markName && mark.attrs.dataTracked?.length) {
          return mark
        }
      })
      /*
        since we preserve the mark always only with different dataTracked attrs, Prosemirror will always send us RemoveMark or RemoveNodeMark
        and we need to process it differently based on pre-existing dataTracked
      */
      const nodeEnd = targetNodePos + targetNode.nodeSize
      if (parentsSameMark && step.from <= nodeEnd && step.to <= nodeEnd) {
        sameMark = parentsSameMark
      }
    }

    const newDataTracked = createNewDeleteAttrs(emptyAttrs)
    const newMark = markSource.create({
      dataTracked: [{ ...newDataTracked, id: uuidv4() }],
    })
    // restoring back the deleted mark but with "deleted" attributes
    let newStep = new AddMarkStep(step.from, step.to, newMark)

    if (sameMark) {
      if (markHasOp(step.mark, CHANGE_OPERATION.delete)) {
        newStep = new AddMarkStep(
          step.from,
          step.to,
          markSource.create({
            dataTracked: [],
          })
        )
      }
      if (markHasOp(step.mark, CHANGE_OPERATION.insert)) {
        newStep = new RemoveMarkStep(step.from, step.to, step.mark)
      }
    }

    try {
      const inverted = step.invert()
      newTr.step(inverted)
      newTr.step(newStep)
    } catch (e) {
      console.error('Unable to record a RemoveMarkStep with error: ' + e)
    }
  }
}

export function trackRemoveNodeMarkStep(
  step: RemoveNodeMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  doc: PMNode
) {
  if (isValidTrackableMark(step.mark)) {
    const markName = step.mark.type.name
    const markSource = step.mark.type.schema.marks[markName]

    let sameMark: Mark | null = null

    const targetNode = doc.nodeAt(step.pos)
    if (targetNode) {
      /*
        since we preserve the mark always only with different dataTracked attrs, Prosemirror will always send us RemoveMark or RemoveNodeMark
        and we need to process it differently based on pre-existing dataTracked
      */
      targetNode.marks.find((mark) => {
        if (mark.type.name === markName && mark.attrs.dataTracked?.length) {
          sameMark = mark
        }
      })
    }

    const newDataTracked = createNewDeleteAttrs(emptyAttrs)
    const newMark = markSource.create({
      dataTracked: [{ ...newDataTracked, id: uuidv4() }],
    })
    // restoring back the deleted mark but with "deleted" attributes
    let newStep = new AddNodeMarkStep(step.pos, newMark)

    if (sameMark) {
      if (markHasOp(step.mark, CHANGE_OPERATION.delete)) {
        newStep = new AddNodeMarkStep(
          step.pos,
          markSource.create({
            dataTracked: [],
          })
        )
      }
      if (markHasOp(step.mark, CHANGE_OPERATION.insert)) {
        newStep = new AddNodeMarkStep(step.pos, step.mark)
      }
    }
    try {
      const inverted = step.invert(doc)
      newTr.step(inverted)
      newTr.step(newStep)
    } catch (e) {
      console.error('Unable to record a RemoveNodeMarkStep with error: ' + e)
    }
  }
}

export function trackAddMarkStep(
  step: AddMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  doc: PMNode
) {
  if (isValidTrackableMark(step.mark)) {
    const markName = step.mark.type.name
    const markSource = step.mark.type.schema.marks[markName]

    const newDataTracked = createNewInsertAttrs(emptyAttrs)
    const newMark = markSource.create({
      dataTracked: [{ ...newDataTracked, id: uuidv4() }],
    })
    const newStep = new AddMarkStep(step.from, step.to, newMark)
    try {
      const inverted = step.invert()
      newTr.step(inverted)
      newTr.step(newStep)
    } catch (e) {
      console.error('Unable to record a remove node mark step: ' + e)
    }
  }
}

export function trackAddNodeMarkStep(
  step: AddNodeMarkStep,
  emptyAttrs: NewEmptyAttrs,
  newTr: Transaction,
  stepDoc: PMNode
) {
  if (isValidTrackableMark(step.mark)) {
    const newDataTracked = createNewInsertAttrs(emptyAttrs)
    const markSource = step.mark.type.schema.marks[step.mark.type.name]
    const newMark = markSource.create({
      dataTracked: [{ ...newDataTracked, id: uuidv4() }],
    })
    const newStep = new AddNodeMarkStep(step.pos, newMark)
    try {
      const inverted = step.invert(stepDoc)
      newTr.step(inverted)
      newTr.step(newStep)
    } catch (e) {
      console.error('Unable to record an AddNodeMarkStep with error: ' + e)
    }
  }
}

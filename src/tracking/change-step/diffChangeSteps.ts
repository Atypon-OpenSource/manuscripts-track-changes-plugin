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

import { Fragment, Node as PMNode, Schema, Slice } from 'prosemirror-model'
import { Mapping } from 'prosemirror-transform'

import { cutFragment } from '../../helpers/fragment'
import { ExposedSlice } from '../../types/pm'
import { log } from '../../utils/logger'
import { matchInserted } from '../lib/matchInserted'
import { ChangeStep, InsertSliceStep } from './type'

/**
 * Finds text changes that overlap and creates single change for them. Needed only for ReplaceAround and Replace steps as those are only once making such changes
 */
export function diffChangeSteps(steps: ChangeStep[]) {
  const deleted = steps.filter((s) => s.type !== 'insert-slice')
  const inserted = steps.filter((s) => s.type === 'insert-slice') as InsertSliceStep[]

  log.info('INSERT STEPS: ', inserted)

  const updated: ChangeStep[] = []
  let updatedDeleted: ChangeStep[] = [...deleted]
  inserted.forEach((ins) => {
    log.info('DIFF ins ', ins)
    //
    // @TODO this is a temporary workaround to prevent duplicated diffing between splitSliceIntoMergedParts and
    // matchInserted.
    //
    // As originally authored splitSliceIntoMergedParts splits open slices into their merged parts
    // leaving out the need to insert the possibly deleted nodes into the doc. However, as matchInserted now
    // traverses the deleted range checking it against the inserted slice this behaves quite in a same way
    // where the opened block nodes are traversed but left unmodified. With an openStart > 0 though the
    // node-attr-updates would additionally have to be filtered out in the processChangeSteps.
    //
    // The old logic is still left as it's as refactoring is painful and would probably break something and just
    // in general, take a lot of time. Therefore, this sliceWasSplit boolean is used to just skip diffing.
    if (ins.sliceWasSplit) {
      updated.push(ins)
      return
    }
    // Start diffing from the start of the deleted range
    const deleteStart = updatedDeleted.reduce((acc, cur) => {
      if (cur.type === 'delete-node') {
        return Math.min(acc, cur.pos)
      } else if (cur.type === 'delete-text') {
        return Math.min(acc, cur.from)
      }
      return acc
    }, Number.MAX_SAFE_INTEGER)
    const [matchedDeleted, updatedDel] = matchInserted(deleteStart, updatedDeleted, ins.slice.content)
    if (matchedDeleted === deleteStart) {
      updated.push(ins)
      return
    }
    updatedDeleted = updatedDel
    const [_, newInserted] = cutFragment(0, matchedDeleted - deleteStart, ins.slice.content)
    if (newInserted.size > 0) {
      updated.push({
        ...ins,
        slice: new Slice(newInserted, ins.slice.openStart, ins.slice.openEnd) as ExposedSlice,
      })
    }
  })
  log.info('FINISH DIFF: ', [...updatedDeleted, ...updated])
  return [...updatedDeleted, ...updated]
}

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

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
import { Transaction } from 'prosemirror-state'
import { Step } from 'prosemirror-transform'

import { TrTrackingContext } from '../../types/track'
import { log } from '../../utils/logger'

export function processStepsBeforeTracking(
  tr: Transaction,
  trContext: TrTrackingContext,
  processors: Array<(tr: Transaction, context: TrTrackingContext) => Step[] | void>
) {
  let steps: Step[] = []
  processors.forEach((p) => {
    const res = p(tr, trContext)
    if (res) {
      steps = res
    }

    if (steps.length < tr.steps.length) {
      log.warn(
        'Bug! A processor function filtered steps incorrectly. Filtered out steps should be replaced with null and not popped out of the array. Length and order has to be preserved'
      )
    }
  })
  return steps
}

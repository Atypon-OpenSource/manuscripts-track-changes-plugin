/*!
 * © 2021 Atypon Systems LLC
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
import type { CreateExtensionFn, EditorProviders } from '@manuscripts/manuscript-editor'

import * as commands from './commands'
import { enableDebug } from './logger'
import { trackChangesPlugin } from './plugin'
import type { TrackChangesOptions } from './types/track'

export const trackChangesExtensionName = 'track-changes' as const

export const trackChangesExtension = (opts?: TrackChangesOptions) => (ctx: EditorProviders) => {
  enableDebug(!!opts?.debug)
  return {
    name: trackChangesExtensionName,
    commands,
    keymaps: [],
    plugins: [trackChangesPlugin(opts)],
    store: undefined,
  }
}

// Poor man's type check. Can check only for mistypings of properties, not for extra properties
function typeCheck(): CreateExtensionFn {
  return trackChangesExtension
}

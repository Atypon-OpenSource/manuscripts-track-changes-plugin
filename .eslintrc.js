/*!
 * The contents of this file are subject to the Common Public Attribution License Version 1.0 (the “License”); you may not use this file except in compliance with the License. You may obtain a copy of the License at https://mpapp-public.gitlab.io/manuscripts-frontend/LICENSE. The License is based on the Mozilla Public License Version 1.1 but Sections 14 and 15 have been added to cover use of software over a computer network and provide for limited attribution for the Original Developer. In addition, Exhibit A has been modified to be consistent with Exhibit B.
 *
 * Software distributed under the License is distributed on an “AS IS” basis, WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License for the specific language governing rights and limitations under the License.
 *
 * The Original Code is manuscripts-frontend.
 *
 * The Original Developer is the Initial Developer. The Initial Developer of the Original Code is Atypon Systems LLC.
 *
 * All portions of the code written by Atypon Systems LLC are Copyright (c) 2020 Atypon Systems LLC. All Rights Reserved.
 */
const cpalLicense = require('@manuscripts/eslint-config/config/cpal-license')

module.exports = {
  extends: '@manuscripts/eslint-config',
  rules: {
    'header/header': [2, 'block', cpalLicense('manuscripts-frontend')],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    'import/no-named-as-default': 'off',
    'import/no-named-as-default-member': 'off',
    'promise/always-return': 'off',
    'promise/no-nesting': 'off',
    'promise/no-promise-in-callback': 'off',
    'react/no-deprecated': 'off',
    'jsx-a11y/no-autofocus': 'off',
    'jsx-a11y/no-onchange': 'off',
  },
}

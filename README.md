# zendesk-actions
Github Action to update Zendesk tickets.

## Setup Instructions
* Install node either from your package manager, `brew install node`, or directly from [node](https://nodejs.org).
* Setup project. From your terminal - `npm init -y`
* Install our build tool, `vercel/ncc`. From your terminal - `npm i -g @vercel/ncc`
## Development
* Edit `index.js`. The `dist/` directory for building, do not edit files within.
* Once ready to commit your changes build with - `ncc build index.js --license licenses.txt`


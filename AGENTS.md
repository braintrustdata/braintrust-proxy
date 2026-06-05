# Deprecated repository

This entire repository/submodule is the deprecated Braintrust proxy. If your
workspace root is this directory, you are already in the deprecated proxy code.

Do not search here for model routing, provider translation, request/response
shaping, or gateway bug fixes. Those live in the `gateway/` directory of the
parent Braintrust repository, normally available from here as `../gateway/`.

For any model routing or translation bug, leave this repository and search/edit
`../gateway/` instead. Only change files in this repository when the user
explicitly asks for work in the deprecated proxy code.

One important exception: changes to `model_list.json` are valid and do belong
in this repository.

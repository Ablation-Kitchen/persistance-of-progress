# paths/

Learning Path files (`*.yaml` / `*.yml`) placed here show up in the app's picker. Compose mounts this folder read-only at `/paths`; the app never writes to it.

- `eval-infra-17-weeks.yaml`: the 17-week sample (6 Blocks, 123 Tasks). It is also the acceptance fixture.
- Paths must validate against the schema in [`../core/schema/learning-path.schema.json`](../core/schema/learning-path.schema.json).
- Editing a file that an Enrollment came from makes the app show a "review reload" banner. Nothing reloads automatically.

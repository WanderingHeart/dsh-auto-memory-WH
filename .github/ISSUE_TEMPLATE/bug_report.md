name: Bug report
description: Something breaks or behaves unexpectedly
labels: ['bug']
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: A clear description of the problem. If the memory panel is involved, what did it show?
    validations:
      required: true
  - type: textarea
    id: reproduce
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. DSH Desktop 0.2.1-rc.5 with a disposable test profile and WH 0.1.0-rc.4
        2. Created and reviewed a synthetic memory
        3. Opened a new session and described the observed result
    validations:
      required: true
  - type: input
    id: versions
    attributes:
      label: Versions
      description: 'dsh-auto-memory-wh version, dsh version (embedded dsh.cmd --version), OS'
      placeholder: 'WH 0.1.0-rc.4, DSH Desktop 0.2.1-rc.5 nightly, Windows 11'
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Relevant logs
      description: 'Only minimal relevant output. Remove credentials, personal memory text, local paths and session tokens before posting.'
      render: shell
  - type: markdown
    attributes:
      value: |
        WH uses `$DSH_HOME/memory-wh/` by default, unless `memoryDir` is set.
        The upstream plugin used a separate directory. Never post real memory files,
        profile contents, backups or authentication links in an issue.
        See `docs/configuration.md` and `docs/storage-recovery.md` before editing data.

#!/usr/bin/env zsh

openclaw plugins uninstall tasktrace-mcp-plugin
rm -rf ~/.openclaw/extensions/tasktrace-mcp-plugin
openclaw plugins install .

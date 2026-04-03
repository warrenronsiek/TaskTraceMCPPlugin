#!/usr/bin/env zsh

openclaw plugins uninstall tasktrace-mcp
openclaw plugins uninstall tasktrace-channel
rm -rf ~/.openclaw/extensions/tasktrace-mcp
rm -rf ~/.openclaw/extensions/tasktrace-channel
openclaw plugins install .

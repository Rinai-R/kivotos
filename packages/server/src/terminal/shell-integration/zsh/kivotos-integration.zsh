if [[ -n "${_KIVOTOS_ZSH_INTEGRATION_LOADED-}" ]]; then
  return
fi
typeset -g _KIVOTOS_ZSH_INTEGRATION_LOADED=1

autoload -Uz add-zsh-hook

typeset -g _KIVOTOS_ZSH_COMMAND_ACTIVE=0

function _kivotos_osc633() {
  printf '\e]633;%s\a' "$1"
}

function _kivotos_precmd() {
  local command_status=$?
  if [[ "$_KIVOTOS_ZSH_COMMAND_ACTIVE" == "1" ]]; then
    _kivotos_osc633 "D;${command_status}"
    _KIVOTOS_ZSH_COMMAND_ACTIVE=0
  fi
  printf '\e]2;%s\a' "${PWD/#$HOME/~}"
  _kivotos_osc633 "A"
}

function _kivotos_preexec() {
  _KIVOTOS_ZSH_COMMAND_ACTIVE=1
  _kivotos_osc633 "B"
  _kivotos_osc633 "C"
  printf '\e]2;%s\a' "$1"
}

add-zsh-hook precmd _kivotos_precmd
add-zsh-hook preexec _kivotos_preexec

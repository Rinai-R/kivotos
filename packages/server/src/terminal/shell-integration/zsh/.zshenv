typeset -g KIVOTOS_SHELL_INTEGRATION_DIR="${${(%):-%N}:A:h}"

if [[ -n "${KIVOTOS_ZSH_ZDOTDIR-}" ]]; then
  export ZDOTDIR="${KIVOTOS_ZSH_ZDOTDIR}"
else
  unset ZDOTDIR
fi

if [[ -n "${ZDOTDIR-}" ]]; then
  if [[ -f "${ZDOTDIR}/.zshenv" ]]; then
    source "${ZDOTDIR}/.zshenv"
  fi
elif [[ -f "${HOME}/.zshenv" ]]; then
  source "${HOME}/.zshenv"
fi

source "${KIVOTOS_SHELL_INTEGRATION_DIR}/kivotos-integration.zsh"

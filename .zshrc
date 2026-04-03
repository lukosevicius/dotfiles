# Oh My Zsh
# =================================

export ZSH="/Users/mantas/.oh-my-zsh"
ZSH_THEME="powerlevel10k/powerlevel10k"
# ZSH_THEME="robbyrussell"
# ZSH_THEME="agnoster"

plugins=(
  git
)
source $ZSH/oh-my-zsh.sh

# Scripts and Alias
# =================================

function addToPATH {
  case ":$PATH:" in
    *":$1:"*) :;; # already there
    *) PATH="$1:$PATH";; # or PATH="$PATH:$1"
  esac
}

# source all alias
for FILE in `find ~/dotfiles/alias`
do
  [ -f $FILE ] && source $FILE
done

# source git alias
source ~/dotfiles/git/.alias

# add all scripts to PATH
export PATH=$PATH:/Users/mantas/Library/Python/3.9/bin
export PATH=$PATH:/Users/mantas/dotfiles/scripts
export PATH=$PATH:/Users/mantas/dotfiles/scripts/git
export PATH=$PATH:/Users/mantas/dotfiles/scripts/wordpress
export PATH=$PATH:/Users/mantas/dotfiles/private
export PATH=$PATH:/Users/mantas/dotfiles/git

# for FILE in `find ~/dotfiles/scripts`
# do
#   [ -f $FILE ] && addToPATH $FILE
# done


# Other
# =================================

export VISUAL=vim
export EDITOR="$VISUAL"

# Get colors from this dir
# if [ -f ~/.dircolors ]; then
  # eval $(dircolors ~/.dircolors)
# fi


# colorize man pages

export LESS_TERMCAP_mb=$'\e[1;32m'
export LESS_TERMCAP_md=$'\e[1;32m'
export LESS_TERMCAP_me=$'\e[0m'
export LESS_TERMCAP_se=$'\e[0m'
export LESS_TERMCAP_so=$'\e[01;33m'
export LESS_TERMCAP_ue=$'\e[0m'
# export LESS_TERMCAP_us=$'\e[1;4;31m'source ~/powerlevel10k/powerlevel10k.zsh-theme

# To customize prompt, run `p10k configure` or edit ~/.p10k.zsh.
[[ ! -f ~/.p10k.zsh ]] || source ~/.p10k.zsh

# bun completions
[ -s "/Users/mantas/.bun/_bun" ] && source "/Users/mantas/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

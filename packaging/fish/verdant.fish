# Verdant shell integration — OSC 133 block markers.
# FALLBACK for fish < 4 (fish >= 4 emits these markers natively).
# Install (optional): copy this file to ~/.config/fish/conf.d/verdant.fish
#
# Markers emitted:
#   ESC ] 133 ; A BEL             prompt start   (fish_prompt)
#   ESC ] 133 ; B ;cmd=<b64> BEL  command start  (fish_preexec; raw commandline, base64)
#   ESC ] 133 ; C BEL             command end    (fish_postexec)
#
# The frontend strips these markers before writing to xterm, so the shell
# prompt and TUI apps render exactly as if this file did not exist.

function __verdant_prompt_start --on-event fish_prompt
    printf "\e]133;A\a"
end

function __verdant_command_start --on-event fish_preexec
    set -l cmd (commandline)
    if test -n "$cmd"
        printf "\e]133;B;cmd=%s\a" (printf "%s" "$cmd" | base64 -w0)
    end
end

function __verdant_command_end --on-event fish_postexec
    printf "\e]133;C\a"
end
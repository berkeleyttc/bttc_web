cd /Users/danohlsen/Sites/bttc_web

read -p "Be sure to save any uncommitted changes in the repo before continuing.
Press enter to continue:"

git reset --hard
git clean -f -d

git checkout main
git pull

echo "Enter a new results branch name (ie results-2024May10):"
read name

git checkout -b "$name"

read -p "Add results PDF, edit results index, then press enter to continue:"

git add .
git commit -m "added results for $name"
git push --set-upstream origin "$name"

open "https://github.com/berkeleyttc/bttc_web/compare"

echo "Branch $name was pushed upstream. Create a new PR against this branch."
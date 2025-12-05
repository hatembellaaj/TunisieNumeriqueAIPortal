FROM nginx:alpine

# Supprime le site par défaut
RUN rm -rf /usr/share/nginx/html/*

# Copie le contenu de ton frontend dans le dossier web de Nginx
COPY . /usr/share/nginx/html

EXPOSE 80

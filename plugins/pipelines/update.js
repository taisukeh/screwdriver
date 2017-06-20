'use strict';

const boom = require('boom');
const joi = require('joi');
const schema = require('screwdriver-data-schema');
const idSchema = joi.reach(schema.models.pipeline.base, 'id');
const updateSchema = joi.reach(schema.models.pipeline.update);
const helper = require('./helper');

module.exports = () => ({
    method: 'PUT',
    path: '/pipelines/{id}',
    config: {
        description: 'Update a pipeline',
        notes: 'Update a specific pipeline',
        tags: ['api', 'pipelines'],
        auth: {
            strategies: ['token', 'session'],
            scope: ['user']
        },
        handler: (request, reply) => {
            const checkoutUrl = helper.formatCheckoutUrl(request.payload.checkoutUrl);
            const id = request.params.id;
            const pipelineFactory = request.server.app.pipelineFactory;
            const userFactory = request.server.app.userFactory;
            const username = request.auth.credentials.username;

            return Promise.all([
                pipelineFactory.get({ id }),
                userFactory.get({ username })
            ])
            // get the current pipeline and user
            .then(([oldPipeline, user]) => {
                // if the pipeline ID is invalid, reject
                if (!oldPipeline) {
                    throw boom.notFound(
                      `Pipeline ${id} does not exist`);
                }

                // get user token
                return user.unsealToken()
                    // get the scm URI
                    .then(token => pipelineFactory.scm.parseUrl({
                        checkoutUrl,
                        token
                    }))
                    // get the user permissions for the repo
                    .then(scmUri => user.getPermissions(scmUri)
                        // if the user isn't an admin, reject
                        .then((permissions) => {
                            if (!permissions.admin) {
                                throw boom.unauthorized(
                                  `User ${username} is not an admin of this repo`);
                            }
                        })
                        // see if there is already a pipeline with the new checkoutUrl
                        .then(() => pipelineFactory.get({ scmUri }))
                        .then((newPipeline) => {
                            // if there is already a pipeline for the new checkoutUrl, reject
                            if (newPipeline) {
                                throw boom.conflict(
                                    `Pipeline already exists with the ID: ${newPipeline.id}`);
                            }

                            // update keys
                            oldPipeline.scmUri = scmUri;
                            oldPipeline.admins = {
                                [username]: true
                            };

                            // update pipeline with new scmRepo and branch
                            return oldPipeline.update()
                            .then(updatedPipeline => updatedPipeline.sync())
                            .then(syncedPipeline => reply(syncedPipeline.toJson()).code(200));
                        })
                    );
            })
            // something broke, respond with error
            .catch(err => reply(boom.wrap(err)));
        },
        validate: {
            params: {
                id: idSchema
            },
            payload: updateSchema
        }
    }
});
